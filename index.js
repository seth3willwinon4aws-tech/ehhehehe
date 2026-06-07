const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const fs = require("fs");

const MEMORY_FILE = "./memory.json";

// ============================================================
// Memory persistence
// ============================================================
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load memory:", e);
  }
  return {};
}

function saveMemory(allMemory) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(allMemory, null, 2));
  } catch (e) {
    console.error("Failed to save memory:", e);
  }
}

// Global memory store — { botName: { channelId: [...messages] } }
let globalMemory = loadMemory();

function getBotMemory(botName, channelId) {
  if (!globalMemory[botName]) globalMemory[botName] = {};
  if (!globalMemory[botName][channelId]) globalMemory[botName][channelId] = [];
  return globalMemory[botName][channelId];
}

function addToMemory(botName, channelId, role, content) {
  const mem = getBotMemory(botName, channelId);
  mem.push({ role, content });
  if (mem.length > 10) mem.shift();
  saveMemory(globalMemory);
}

// ============================================================
// GitHub Models AI helper
// ============================================================
async function askAI(personality, conversationHistory) {
  const messages = [
    { role: "system", content: personality },
    ...conversationHistory,
  ];

  const response = await fetch(
    "https://models.inference.ai.azure.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 150,
        temperature: 0.9,
      }),
    }
  );

  const text = await response.text();
  console.log("AI raw response:", text);

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI response:", e);
    return null;
  }

  if (!data.choices || !data.choices[0]) {
    console.error("No choices in AI response:", data);
    return null;
  }

  return data.choices[0].message.content.trim();
}

// ============================================================
// Track last message time
// ============================================================
let lastMessageTime = Date.now();
let botChatActive = false;

// ============================================================
// Create a bot client
// ============================================================
function createBot(name, botConfig) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", () => {
    console.log(`${name} is online as ${client.user.tag}!`);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.id === client.user?.id) return;

    if (!message.author.bot) {
      lastMessageTime = Date.now();
      botChatActive = false;
    }

    const channelId = message.channel.id;

    addToMemory(
      name,
      channelId,
      message.author.bot ? "assistant" : "user",
      `${message.author.username}: ${message.content}`
    );

    const mentioned = message.mentions.users.has(client.user.id);
    if (!mentioned) return;

    console.log(`${name} was mentioned, generating response...`);

    try {
      await message.channel.sendTyping();
      const mem = getBotMemory(name, channelId);
      const reply = await askAI(botConfig.personality, mem);
      if (reply) {
        await message.reply(reply);
        addToMemory(name, channelId, "assistant", reply);
        console.log(`${name} replied: ${reply}`);
      } else {
        console.error(`${name} got null reply from AI`);
        await message.reply("...");
      }
    } catch (err) {
      console.error(`${name} error responding:`, err);
    }
  });

  client.login(botConfig.token).catch(err => {
    console.error(`${name} failed to login:`, err);
  });

  return client;
}

// ============================================================
// Bot-to-bot chat when server is quiet
// ============================================================
const botClients = {};

async function startBotChat() {
  if (botChatActive) return;
  botChatActive = true;

  const botNames = Object.keys(config.BOTS);
  const channelId = config.BOT_CHAT_CHANNEL;
  let lastSpeaker = null;

  for (let i = 0; i < 5; i++) {
    const quietTime = (Date.now() - lastMessageTime) / 1000 / 60;
    if (quietTime < config.QUIET_THRESHOLD_MINUTES) {
      botChatActive = false;
      return;
    }

    let speakerName;
    do {
      speakerName = botNames[Math.floor(Math.random() * botNames.length)];
    } while (speakerName === lastSpeaker);

    lastSpeaker = speakerName;
    const client = botClients[speakerName];
    if (!client) continue;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error("Could not find bot chat channel:", channelId);
      continue;
    }

    const mem = getBotMemory(speakerName, channelId);
    const contextHistory = [
      ...mem,
      {
        role: "user",
        content: "You're hanging out in the Chaos Party Discord with the other characters. Say something casual.",
      },
    ];

    try {
      const reply = await askAI(config.BOTS[speakerName].personality, contextHistory);
      if (reply) {
        await channel.send(reply);
        addToMemory(speakerName, channelId, "assistant", reply);

        // Share to other bots' memory
        for (const otherName of botNames) {
          if (otherName !== speakerName) {
            addToMemory(otherName, channelId, "user", `${speakerName}: ${reply}`);
          }
        }
      }
    } catch (err) {
      console.error(`Bot chat error (${speakerName}):`, err);
    }

    await new Promise((r) => setTimeout(r, 8000 + Math.random() * 7000));
  }

  botChatActive = false;
}

// ============================================================
// Start all bots
// ============================================================
for (const [name, botConfig] of Object.entries(config.BOTS)) {
  botClients[name] = createBot(name, botConfig);
}

setInterval(() => {
  const quietMinutes = (Date.now() - lastMessageTime) / 1000 / 60;
  if (quietMinutes >= config.QUIET_THRESHOLD_MINUTES && !botChatActive) {
    console.log("Server quiet, starting bot chat...");
    startBotChat();
  }
}, 60 * 1000);

// ============================================================
// Keep-alive server
// ============================================================
const http = require("http");
http.createServer((req, res) => res.end("alive")).listen(process.env.PORT || 3000);
setInterval(() => {
  http.get(`http://localhost:${process.env.PORT || 3000}`);
}, 5 * 60 * 1000);

console.log("Chaos Party bots starting up...");
