# Chaos Party Discord Bots

## Setup

1. Install Node.js from nodejs.org
2. Open a terminal in this folder
3. Run: npm install
4. Open config.js and fill in your tokens
5. Run: npm start

## Config.js — What to fill in

- GITHUB_TOKEN — your GitHub Models token
- BOT_CHAT_CHANNEL — right click a channel in Discord (dev mode on) → Copy ID
- BOTS > each character > token — your 4 Discord bot tokens

## How it works

- Each bot responds when @mentioned
- After 5 minutes of quiet, bots start chatting with each other automatically
- They share conversation memory so replies feel connected

## Keeping it online 24/7

To keep bots online when your laptop is off, host on:
- Railway.app (free tier)
- Render.com (free tier)
- Fly.io (free tier)
