# Agent Office

A Claude Code mod that shows your agents as a team of ten people working in a 3D office. It opens in your browser at http://127.0.0.1:4477.

- **The team:** Wren, the coordinator, is your main conversation. One person stands for each of your most-used agent types, plus a receptionist and a floater. When more agents run at once than there are people, people take on extra jobs.
- **The office:** working people sit at their desks, type, and use the mouse. People between tasks get coffee, play ping-pong, read in the lounge, or meet.
- **Hover** over someone to see what they are doing. **Click** them to chat; your message reaches the agent through Claude.
- **The Brain** (top right): the code index as a brain, your people around it linked to the parts of the code they searched, and the workflow — who handed which job to whom, in order. A copy of the brain floats above the office, with a beam to everyone at work; click it to open the panel.
- **Background tasks:** commands and monitors left running show as a purple ⟳ badge over the head of whoever started them, as a count in the header, and as a list in the Brain panel, with how each one ended.
- **The Team window** (top right) renames people or changes their roles. Their desk and department move with them.
- **Every open Claude Code session** shows in the same office.

## What you need

- Claude Code: the terminal, the desktop app, or the VS Code extension.
- Node.js on your PATH (`node --version` should print a version). The office runs a small local server.
- An internet connection the first time the page loads, to fetch three.js from a CDN.

## Install from the zip

1. Unzip `agent-office.zip` somewhere permanent, for example `~/claude-mods/agent-office`. Claude Code reads the plugin from that folder, so don't delete it.
2. Add it as a marketplace and install it. Pick **one** of these:

   **From a terminal:**

   ```
   claude plugin marketplace add ~/claude-mods/agent-office
   claude plugin install agent-office@agent-office --scope user
   ```

   **At a Claude Code prompt** (terminal or the VS Code extension):

   ```
   /plugin marketplace add ~/claude-mods/agent-office
   /plugin install agent-office@agent-office
   ```

   Choose "user" scope when asked, so it works in every project.

3. Start a new Claude Code session. The office opens in your browser on its own. If it doesn't, type `/office`, then open http://127.0.0.1:4477.

## Your team

The first session creates `~/.claude/agent-office/team.json` from your agent types:

- the built-in ones (Explore, general-purpose and others);
- any custom agents in `~/.claude/agents/` or the project's `.claude/agents/`.

After that the file is yours: edit it in the Team window, or by hand. The office holds 10 people; to change who is in it, remove someone first. Each person's looks come from their id, so the same roster looks the same on every machine.

## Handy console commands

Open the browser console on the office page (Chrome: `Cmd + Option + J`):

- `officePerf()`: frames per second, quality level and draw calls.
  - `quality: 2` is full quality with ambient occlusion.
  - `1` means ambient occlusion is off to keep things smooth.
  - `0` means the resolution has also been lowered.
- `officeLook('Wren', 1.5)`: frames one person up close.
- `officeDebug()`: lists where everyone is and what they're doing.

## Uninstall

```
claude plugin uninstall agent-office
```

Your roster and session files stay in `~/.claude/agent-office/`. Delete that folder to remove them too.
