# The Underworld — a 1920s noir Mafia party game

A mobile-first web app for playing Mafia live with 15–20 people, each on their own phone. One person runs it as the **Narrator**; everyone else joins as a **Guest** via one shared link.

This is a plain static site (`index.html` + `style.css` + `app.js`) — no build step, no framework. The only thing making it "live" across everyone's phones is a free **Firebase Realtime Database**, which stores the shared game state (players, roles, votes, chat) that every phone reads and writes to.

## 1. Create your free Firebase database (~5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**. Name it anything (e.g. `underworld-mafia`). You can skip Google Analytics.
2. In the left sidebar, go to **Build > Realtime Database**, click **Create Database**. Pick any region, and choose **Start in test mode** for now (you'll lock it down with the rules below).
3. In the left sidebar, click the gear icon > **Project settings** > scroll to **Your apps** > click the **`</>`** (Web) icon > give it any nickname > **Register app**.
4. Firebase will show you a `firebaseConfig` object. Copy it.
5. Open `firebase-config.js` in this project and paste your values in, replacing the placeholder ones.

## 2. Lock down the database rules

By default "test mode" allows anyone to read/write for 30 days, then locks everyone out. Go to **Realtime Database > Rules** in the Firebase console and paste this in (works indefinitely, and is appropriately open for a single private party game — anyone with your game link can already see/change game data by design, since that's how guests vote):

```json
{
  "rules": {
    "game": {
      ".read": true,
      ".write": true
    }
  }
}
```

Click **Publish**.

## 3. Push to GitHub

Push this whole folder to a new GitHub repository (you mentioned you'll handle this part).

## 4. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com), sign in, click **Add New > Project**.
2. Import the GitHub repo you just created.
3. Vercel will detect it as a static site — no build command or output directory needed. Just click **Deploy**.
4. Once deployed, Vercel gives you a URL like `underworld-mafia.vercel.app`. That's the one link you send to your guests on WhatsApp.

## How to play

- Whoever opens the link first and taps **Enter as the Narrator** becomes the host — they'll see the guest list, a status view of who has/hasn't voted each phase, and a single "Continue" button to advance the story once everyone required has acted.
- Everyone else taps **Enter as a Guest**, types their real name, and gets auto-assigned a 1920s code name (Alfred, Mildred, Cecil, etc.).
- Once at least 5 guests have joined, the Narrator taps **Start the Game & Deal Roles**.
- Roles: Mafia (about 1 in 5 players), one Doctor, everyone else a Villager. A Detective is automatically promoted from a living Villager once only 6 Villagers remain.
- No timers anywhere — every phase advances only when the Narrator says so.
- If a guest's phone drops or the tab closes, reopening the same link on the same phone/browser restores their name, role, and status automatically (this uses `localStorage`, so it's tied to that specific browser).
- To run another game afterward, the Narrator's game-over screen has a **Start a Brand New Game** button that resets everything.

## File overview

- `index.html` — page shell, loads the Firebase SDK and `app.js`.
- `style.css` — the noir/1920s visual styling.
- `app.js` — all game logic: roles, night/day phases, voting, tiebreaks, the eliminated-player puzzle mini-game, and the Narrator's dashboard.
- `firebase-config.js` — your Firebase project keys (fill this in per step 1 above).

## A couple of honest heads-ups

- This was tested logically but not yet with a full 20-person live run — a small dry run with 4–5 people before the real party is a good idea.
- The database rules above are intentionally open (no login system) to keep joining frictionless for guests — don't reuse this Firebase project for anything sensitive.
