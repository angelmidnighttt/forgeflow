#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server for ForgeFlow. Run it as root; running it again is safe
# and only fills in what is missing. It sets up:
# - the latest packages, automatic security updates, a 2 GB swap file when there is none;
# - the firewall (SSH, HTTP, HTTPS) and SSH logins by key only;
# - Docker, with container logs that rotate;
# - a "deploy" user whose SSH key (CI's) can only run forgeflow-deploy;
# - /opt/forgeflow: the repository, a .env with fresh secrets, a daily database backup.
#
# From a machine that can already SSH in as root with a key:
#   ssh root@<server> "SITE_HOST=<ip-with-dashes>.sslip.io DEPLOY_PUBLIC_KEY='$(cat <key>.pub)' bash -s" \
#     < infra/staging/scripts/bootstrap.sh
set -euo pipefail

step() { printf '\n==> %s\n' "$*"; }
fail() {
  echo "bootstrap: $*" >&2
  exit 1
}

# Everything runs from main, so bash has read the whole script before any command could read
# stdin (the script itself arrives on stdin with `bash -s`).
main() {
  local site_host=${SITE_HOST:?set SITE_HOST, e.g. 203-0-113-10.sslip.io}
  local deploy_key=${DEPLOY_PUBLIC_KEY:?set DEPLOY_PUBLIC_KEY to the CI deploy public key}
  local repo_url=${REPO_URL:-https://github.com/angelmidnighttt/forgeflow.git}
  local root=/opt/forgeflow
  local scripts=infra/staging/scripts
  local host_pattern='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  local key_pattern='^ssh-ed25519 [A-Za-z0-9+/]+=*( [[:print:]]*)?$'

  [[ $(id -u) -eq 0 ]] || fail 'run it as root'
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ ${ID:-} == ubuntu ]] || fail "expects Ubuntu, found ${PRETTY_NAME:-an unknown system}"
  [[ $site_host =~ $host_pattern ]] || fail "SITE_HOST is not a host name: $site_host"
  [[ $deploy_key =~ $key_pattern ]] ||
    fail 'DEPLOY_PUBLIC_KEY must be one ssh-ed25519 public key (the contents of the .pub file)'
  cd /

  step 'System packages and automatic security updates'
  export DEBIAN_FRONTEND=noninteractive
  local apt_options=(-yq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
  apt-get update -q < /dev/null
  apt-get upgrade "${apt_options[@]}" < /dev/null
  apt-get install "${apt_options[@]}" ca-certificates cron curl git openssl ufw \
    unattended-upgrades < /dev/null
  cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

  step 'Swap'
  if [[ -n $(swapon --show --noheadings) ]]; then
    echo 'Already has swap.'
  elif fallocate -l 2G /swapfile && chmod 0600 /swapfile && mkswap /swapfile > /dev/null &&
    swapon /swapfile; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'Added a 2 GB swap file.'
  else
    rm -f /swapfile
    echo 'This server does not allow a swap file; carrying on without one.'
  fi

  step 'Docker'
  if docker compose version > /dev/null 2>&1; then
    echo 'Already installed.'
  elif command -v docker > /dev/null; then
    fail 'Docker is installed without the compose plugin; remove it or add docker-compose-plugin'
  else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc]" \
      "https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -q < /dev/null
    apt-get install "${apt_options[@]}" docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin < /dev/null
  fi
  # The default log driver keeps every line forever; "local" rotates (100 MB per container).
  if [[ ! -f /etc/docker/daemon.json ]]; then
    install -d /etc/docker
    echo '{ "log-driver": "local" }' > /etc/docker/daemon.json
    systemctl restart docker
  fi
  systemctl enable --now docker > /dev/null 2>&1

  step 'Firewall: SSH, HTTP and HTTPS only'
  # sshd -T / -t need this directory. ssh.service creates it, but Ubuntu starts that service on
  # demand (ssh.socket), and an openssh-server upgrade just above can leave it stopped.
  install -d -m 0755 /run/sshd
  local ssh_ports port
  ssh_ports=$(sshd -T | awk '$1 == "port" { print $2 }') && [[ -n $ssh_ports ]] ||
    fail 'could not read the SSH port from sshd -T; the firewall is unchanged'
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  for port in $ssh_ports; do ufw allow "$port/tcp" > /dev/null; done
  ufw allow 80/tcp > /dev/null
  ufw allow 443/tcp > /dev/null
  ufw allow 443/udp > /dev/null
  ufw --force enable > /dev/null
  ufw status

  step 'SSH: keys only'
  local conf=/etc/ssh/sshd_config.d/00-forgeflow.conf
  if [[ -s /root/.ssh/authorized_keys ||
    (-n ${SUDO_USER:-} && -s /home/${SUDO_USER:-}/.ssh/authorized_keys) ]]; then
    cat > "$conf" << 'EOF'
# Written by ForgeFlow's bootstrap.sh: no password logins, root only with a key.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
    sshd -t || {
      rm -f "$conf"
      fail 'sshd rejected the new settings; removed them, password logins stay on'
    }
    # A stopped ssh.service reads the settings when the next connection starts it.
    if systemctl is-active --quiet ssh.service; then systemctl reload ssh.service; fi
    echo 'Password logins are off.'
  else
    echo '!! No SSH key is set up for root: password logins stay on.'
    echo '!! Add your key (ssh-copy-id root@<server>), check that it works, then run this again.'
  fi

  step "User 'deploy' for CI"
  id deploy > /dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
  # "*": no password can match, but the account is not locked (sshd refuses locked accounts).
  usermod --password '*' --append --groups docker deploy
  install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
  printf 'restrict,command="/usr/local/bin/forgeflow-deploy" %s\n' "$deploy_key" \
    > /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 0600 /home/deploy/.ssh/authorized_keys

  step "Repository and settings in $root"
  install -d -m 0750 -o deploy -g deploy "$root" "$root/backups"
  if [[ -d $root/repo/.git ]]; then
    runuser -u deploy -- git -C "$root/repo" fetch --quiet origin
  else
    runuser -u deploy -- git clone --quiet "$repo_url" "$root/repo"
  fi
  # git runs as deploy, which owns the repository (git refuses other owners' repositories).
  runuser -u deploy -- git -C "$root/repo" show "origin/HEAD:$scripts/forgeflow-deploy.sh" \
    > /usr/local/bin/forgeflow-deploy
  chmod 0755 /usr/local/bin/forgeflow-deploy
  cat > /usr/local/bin/forgeflow-compose << EOF
#!/bin/sh
exec bash $root/repo/$scripts/compose.sh "\$@"
EOF
  chmod 0755 /usr/local/bin/forgeflow-compose

  local created_env=false
  if [[ -f $root/.env ]]; then
    echo "$root/.env exists: left as it is."
  else
    (
      umask 077
      runuser -u deploy -- git -C "$root/repo" show origin/HEAD:infra/staging/.env.example |
        sed -e "s|^SITE_HOST=.*|SITE_HOST=$site_host|" \
          -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 32)|" \
          -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$(openssl rand -hex 32)|" \
          -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" > "$root/.env"
    )
    chown deploy:deploy "$root/.env"
    created_env=true
    echo "Created $root/.env with new secrets."
  fi

  cat > /etc/cron.d/forgeflow-backup << EOF
# Daily dump of the ForgeFlow database at 03:00 server time ($scripts/backup.sh).
0 3 * * * deploy bash $root/repo/$scripts/backup.sh >> $root/backups/backup.log 2>&1
EOF
  chmod 0644 /etc/cron.d/forgeflow-backup

  step 'Done'
  echo "This server's SSH host keys (check them against ssh-keyscan before trusting it in CI):"
  local key
  for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key"; done
  if [[ $created_env == true ]]; then
    echo
    echo "Next: set SMTP_URL and MAIL_FROM (and GitHub sign-in, if wanted) in $root/.env."
  fi
}

main "$@"
