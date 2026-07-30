# copy skills folder from ~/.agents to .devcontainer/skills
if (Test-Path "$env:USERPROFILE\.agents\skills") {
    Copy-Item -Path "$env:USERPROFILE\.agents\skills" -Destination ".devcontainer" -Recurse -Force
}

# copy ~/.pi/agent/AGENTS.md to .devcontainer/AGENTS.md
if (Test-Path "$env:USERPROFILE\.pi\agent\AGENTS.md") {
    Copy-Item -Path "$env:USERPROFILE\.pi\agent\AGENTS.md" -Destination ".devcontainer\AGENTS.md" -Force
}