const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");

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
// Track last message time per channel
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

  const memory = {};

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
    if (!memory[channelId]) memory[channelId] = [];

    memory[channelId].push({
      role: message.author.bot ? "assistant" : "user",
      content: `${message.author.username}: ${message.content}`,
    });

    if (memory[channelId].length > 10) memory[channelId].shift();

    const mentioned = message.mentions.users.has(client.user.id);
    if (!mentioned) return;

    console.log(`${name} was mentioned, generating response...`);

    try {
      await message.channel.sendTyping();
      const reply = await askAI(botConfig.personality, memory[channelId]);
      if (reply) {
        await message.reply(reply);
        memory[channelId].push({ role: "assistant", content: reply });
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

  return { client, memory };
}

// ============================================================
// Bot-to-bot chat when server is quiet
// ============================================================
const botInstances = {};

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
    const instance = botInstances[speakerName];
    if (!instance) continue;

    const channel = await instance.client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error("Could not find bot chat channel:", channelId);
      continue;
    }

    if (!instance.memory[channelId]) instance.memory[channelId] = [];

    const contextHistory = [
      ...instance.memory[channelId],
      {
        role: "user",
        content: "You're hanging out in the Chaos Party Discord with the other characters. Say something casual.",
      },
    ];

    try {
      const reply = await askAI(config.BOTS[speakerName].personality, contextHistory);
      if (reply) {
        await channel.send(reply);
        instance.memory[channelId].push({ role: "assistant", content: reply });

        for (const otherName of botNames) {
          if (otherName !== speakerName && botInstances[otherName]) {
            if (!botInstances[otherName].memory[channelId])
              botInstances[otherName].memory[channelId] = [];
            botInstances[otherName].memory[channelId].push({
              role: "user",
              content: `${speakerName}: ${reply}`,
            });
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
  botInstances[name] = createBot(name, botConfig);
}

setInterval(() => {
  const quietMinutes = (Date.now() - lastMessageTime) / 1000 / 60;
  if (quietMinutes >= config.QUIET_THRESHOLD_MINUTES && !botChatActive) {
    console.log("Server quiet, starting bot chat...");
    startBotChat();
  }
}, 60 * 1000);

// ============================================================
// Keep-alive server so Render never sleeps the app
// ============================================================
const http = require("http");
http.createServer((req, res) => res.end("alive")).listen(process.env.PORT || 3000);
setInterval(() => {
  http.get(`http://localhost:${process.env.PORT || 3000}`);
}, 5 * 60 * 1000);

console.log("Chaos Party bots starting up...");
