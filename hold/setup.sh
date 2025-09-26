#!/usr/bin/env bash
set -euo pipefail

########################################
# Logging Functions
########################################
log_info() {
    printf "[INFO] %s\n" "$1"
}

log_error() {
    printf "[ERROR] %s\n" "$1" >&2
}

########################################
# OS Detection
########################################
detect_os() {
    local os
    os="$(uname)"
    if [[ "$os" == "Linux" ]]; then
        echo "Linux"
    elif [[ "$os" == "Darwin" ]]; then
        echo "Darwin"
    else
        echo "$os"
    fi
}

########################################
# Install OS-Specific Dependencies
########################################
install_dependencies() {
    local os="$1"
    if [[ "$os" == "Linux" ]]; then
        log_info "Detected Linux OS. Updating package list and installing dependencies..."
        SUDO=""
        if command -v sudo >/dev/null 2>&1; then
            SUDO="sudo"
        fi
        $SUDO apt-get update 
        $SUDO apt-get install -y \
                build-essential \
                pkg-config \
                libudev-dev \
                llvm \
                libclang-dev \
                protobuf-compiler \
                libssl-dev
    elif [[ "$os" == "Darwin" ]]; then
        log_info "Detected macOS."
    else
        log_info "Detected $os."
    fi

    echo ""
}

########################################
# Install Rust via rustup
########################################
install_rust() {
    if command -v rustc >/dev/null 2>&1; then
        log_info "Rust is already installed. Updating..."
        rustup update
    else
        log_info "Installing Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        log_info "Rust installation complete."
    fi

    # Source the Rust environment
    if [[ -f "$HOME/.cargo/env" ]]; then
        . "$HOME/.cargo/env"
    elif [[ -f "$HOME/.cargo/env.fish" ]]; then
        log_info "Sourcing Rust environment for Fish shell..."
        source "$HOME/.cargo/env.fish"
    else
        log_error "Rust environment configuration file not found."
    fi

    if command -v rustc >/dev/null 2>&1; then
        rustc --version
    else
        log_error "Rust installation failed."
    fi

    echo ""
}

########################################
#Install Solana CLI
########################################
install_solana_cli() {
local os="$1"
if command -v solana >/dev/null 2>&1; then
log_info "Solana CLI is already installed. Updating..."
agave-install update
else
log_info "Installing Solana CLI..."
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
log_info "Solana CLI installation complete."
fi
if [[ "$os" == "Linux" ]]; then
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bash_profile"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.profile"
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"
elif [[ "$os" == "Darwin" ]]; then
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc
fi
if command -v solana >/dev/null 2>&1; then
solana --version
else
log_error "Solana CLI installation failed."
fi
echo ""
}
########################################
#Install Anchor CLI
########################################
install_anchor_cli() {
if command -v anchor >/dev/null 2>&1; then
log_info "Anchor CLI is already installed. Updating..."
cargo install anchor-cli --version 0.31.1 --force
else
log_info "Installing Anchor CLI..."
cargo install anchor-cli --version 0.31.1 --force
log_info "Anchor CLI installation complete."
fi
if command -v anchor >/dev/null 2>&1; then
anchor --version
else
log_error "Anchor CLI installation failed."
fi
echo ""
}
########################################
#Print Installed Versions
########################################
print_versions() {
echo ""
echo "Installed Versions:"
echo "Rust: $(rustc --version 2>/dev/null || echo 'Not installed')"
echo "Solana CLI: $(solana --version 2>/dev/null || echo 'Not installed')"
echo "Anchor CLI: $(anchor --version 2>/dev/null || echo 'Not installed')"
echo ""
}
########################################
#Main Execution Flow
########################################
main() {
local os
os=$(detect_os)
install_dependencies "$os"
install_rust
install_solana_cli "$os"
install_anchor_cli
print_versions
echo "Installation complete. Please restart your terminal to apply all changes."
}
main "$@"