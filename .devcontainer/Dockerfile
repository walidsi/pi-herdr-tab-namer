FROM mcr.microsoft.com/devcontainers/typescript-node:4-24-bookworm

# Rename the base image's built-in 'node' user to 'agent', keeping its
# existing UID/GID and moving its home dir — avoids creating a second
# user that competes for the same UID during updateRemoteUserUID.
RUN usermod -l agent -d /home/agent -m -s /bin/bash node && \
    groupmod -n agent node

RUN git config --system --add safe.directory /workspaces/*

# -----------------------------------------------------------------------------
# Micro (terminal text editor)
# -----------------------------------------------------------------------------

USER root
RUN apt-get update && apt-get install -y micro && rm -rf /var/lib/apt/lists/*

# Set passwords: agent has no password, root has password 123456
RUN passwd -d agent && \
    echo 'root:123456' | chpasswd

RUN apt-get update && apt-get install -y sudo && \
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    rm -rf /var/lib/apt/lists/*

USER agent

# -----------------------------------------------------------------------------
# Herdr
# -----------------------------------------------------------------------------

RUN curl -fsSL https://herdr.dev/install.sh | sh

# Create Herdr config
RUN mkdir -p /home/agent/.config/herdr && \
    echo 'onboarding = false\n\
    [ui]\n\
    show_agent_labels_on_pane_borders = true\n\
    \n\
    [ui.toast]\n\
    delivery = "herdr"\n\
    \n\
    [theme]\n\
    name = "catppuccin"\n\
    auto_switch = false\n\
    \n\
    [terminal]\n\
    default_shell = "/bin/bash"\n\
    \n\
    [ui.sound]\n\
    enabled = true' > /home/agent/.config/herdr/config.toml && \
    chown -R agent:agent /home/agent/.config

# -----------------------------------------------------------------------------
# Pi Coding
# -----------------------------------------------------------------------------

# Install Pi Coding CLI
RUN curl -fsSL https://pi.dev/install.sh | sh
ENV PATH="/home/agent/.local/bin:${PATH}"


# Skills (from host ~/.agents/skills via named build context)
COPY --chown=agent:agent . /home/agent/.agents/skills/

RUN pi install git:github.com/andrewjacop/pi-herdr@src && \
    pi install git:github.com/gotgenes/pi-permission-system@src && \
    pi install npm:@walidsi/pi-herdr-tab-namer && \
    pi install npm:pi-ask-user && \
    pi install git:github.com/Kilo-Org/kilo-pi-provider@kilo.ts && \
    pi install npm:pi-cwd-guard && \
    pi install npm:pi-memory && \
    pi install npm:pi-model-info && \
    pi install npm:pi-pr-review && \
    pi install npm:pi-show && \
    pi install npm:pi-simplify


# Configure bash prompt with git branch
RUN printf '%s\n' \
    'parse_git_branch() { git branch 2>/dev/null | sed -e "/^[^*]/d" -e "s/\* \(.*\)/ (\1)/"; }' \
    'export PS1='"'"'\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00;33m\]$(parse_git_branch)\[\033[00m\]\$ '"'"'' \
    >> /home/agent/.bashrc
