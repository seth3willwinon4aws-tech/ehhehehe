const { Client, GatewayIntentBits } = require("discord.js");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
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

  const data = await response.json();
  if (!data.choices || !data.choices[0]) return null;
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

  // Conversation memory per channel (last 10 messages)
  const memory = {};

  client.once("ready", () => {
    console.log(`${name} is online!`);
  });

  client.on("messageCreate", async (message) => {
    // Ignore own messages
    if (message.author.bot && message.author.id === client.user.id) return;

    // Update last message time
    if (!message.author.bot) {
      lastMessageTime = Date.now();
      botChatActive = false;
    }

    const channelId = message.channel.id;
    if (!memory[channelId]) memory[channelId] = [];

    // Add message to memory
    memory[channelId].push({
      role: message.author.bot ? "assistant" : "user",
      content: `${message.author.username}: ${message.content}`,
    });

    // Keep only last 10 messages
    if (memory[channelId].length > 10) memory[channelId].shift();

    // Respond if mentioned
    const mentioned = message.mentions.users.has(client.user.id);
    if (!mentioned) return;
    if (message.author.id === client.user.id) return;

    try {
      message.channel.sendTyping();
      const reply = await askAI(botConfig.personality, memory[channelId]);
      if (reply) {
        await message.reply(reply);
        memory[channelId].push({ role: "assistant", content: reply });
      }
    } catch (err) {
      console.error(`${name} error:`, err);
    }
  });

  client.login(botConfig.token);
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

  // Pick a random bot to start the conversation
  let lastSpeaker = null;

  // Chat for about 5 exchanges then stop
  for (let i = 0; i < 5; i++) {
    // Check if a real user came back
    const quietTime = (Date.now() - lastMessageTime) / 1000 / 60;
    if (quietTime < config.QUIET_THRESHOLD_MINUTES) {
      botChatActive = false;
      return;
    }

    // Pick a bot that didn't just speak
    let speakerName;
    do {
      speakerName = botNames[Math.floor(Math.random() * botNames.length)];
    } while (speakerName === lastSpeaker);

    lastSpeaker = speakerName;
    const instance = botInstances[speakerName];
    if (!instance) continue;

    const channel = await instance.client.channels.fetch(channelId).catch(() => null);
    if (!channel) continue;

    if (!instance.memory[channelId]) instance.memory[channelId] = [];

    // Add context that this is bot chat
    const contextHistory = [
      ...instance.memory[channelId],
      {
        role: "user",
        content: "You're hanging out in the Chaos Party Discord with the other characters. Say something casual to start or continue the conversation.",
      },
    ];

    try {
      const reply = await askAI(config.BOTS[speakerName].personality, contextHistory);
      if (reply) {
        await channel.send(reply);
        instance.memory[channelId].push({ role: "assistant", content: reply });

        // Share the message to other bots' memories so they can respond contextually
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

    // Wait 8-15 seconds between messages so it feels natural
    await new Promise((r) =>
      setTimeout(r, 8000 + Math.random() * 7000)
    );
  }

  botChatActive = false;
}

// ============================================================
// Start all bots
// ============================================================
for (const [name, botConfig] of Object.entries(config.BOTS)) {
  botInstances[name] = createBot(name, botConfig);
}

// Check every minute if server has been quiet
setInterval(() => {
  const quietMinutes = (Date.now() - lastMessageTime) / 1000 / 60;
  if (quietMinutes >= config.QUIET_THRESHOLD_MINUTES && !botChatActive) {
    console.log("Server quiet, starting bot chat...");
    startBotChat();
  }
}, 60 * 1000);

console.log("Chaos Party bots starting up...");
