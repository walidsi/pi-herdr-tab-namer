#!/usr/bin/env bash

# copy skills folder from ~/.agents to .devcontainer/skills
if [ -d "$HOME/.agents/skills" ]; then
    cp -r "$HOME/.agents/skills" ".devcontainer"
fi

# copy ~/.pi/agent/AGENTS.md to .devcontainer/AGENTS.md
if [ -f "$HOME/.pi/agent/AGENTS.md" ]; then
    cp "$HOME/.pi/agent/AGENTS.md" ".devcontainer/AGENTS.md"
fi
