# Fitness Tracker

# Start the app server
serve:
    npm start

# Stop the running server
stop:
    pkill -f "node server.js" && echo "Stopped" || echo "Not running"

# Install dependencies
install:
    npm install

# Run the S3 backup once (reads .env)
backup:
    npm run backup

# --- OpenTofu (S3 bucket + IAM backup user) --------------------------------

# Initialize OpenTofu (downloads providers, writes lock file)
tofu-init:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu init

# Check that all .tf files are canonically formatted
tofu-fmt:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu fmt -check -recursive

# Validate HCL syntax and provider schema (no AWS API calls)
tofu-validate:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu validate

# Show the diff between desired and actual AWS state
tofu-plan:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu plan

# Apply the IaC (creates / updates the S3 bucket, IAM user, access key)
tofu-apply:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu apply

# Print the .env snippet (everything except the secret)
tofu-print-env:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu output env_file_snippet

# Print the backup user's AWS_SECRET_ACCESS_KEY (raw, no quotes)
tofu-print-secret:
    AWS_PROFILE=fitness-tracker tofu -chdir=tofu output -raw aws_secret_access_key

# --- Deploy ----------------------------------------------------------------
# The `deploy` recipe expects an SSH alias `fitness-tracker` in ~/.ssh/config:
#
#   Host fitness-tracker
#       HostName <your-server-ip>
#       User <your-user>
#       IdentityFile <path-to-your-ssh-key>

# Rsync the working tree to the server (.env IS included).
# Optional arg = full rsync destination (user@host:/path/). Defaults to the
# `fitness-tracker` SSH alias at ~/fitness-tracker. Examples:
#   just deploy
#   just deploy '<your-user>@<your-server-ip>:/home/<your-user>/fitness-tracker/'
#   just deploy 'pi@fitness-tracker:/opt/fitness-tracker/'
deploy dest='fitness-tracker:~/fitness-tracker/':
    @echo '>> Deploy target: {{dest}}'
    @echo '>> Set up the `fitness-tracker` SSH alias (see comment above) or pass your own dest: just deploy "user@host:/path/". Ctrl-C now if not configured.'
    rsync -av --delete \
        --exclude='node_modules/' \
        --exclude='.git/' \
        --exclude='.claude/' \
        --exclude='data.sqlite*' \
        --exclude='tofu/.terraform/' \
        --exclude='tofu/*.tfstate*' \
        --exclude='tofu/terraform.tfvars' \
        ./ '{{dest}}'

# (Run on the Linux server) Install unit files into /etc/systemd/system/ and reload.
# __USER__ / __HOME__ in the .service files are substituted from the account that
# runs this recipe, so no username is committed to the repo.
systemd-install:
    #!/usr/bin/env bash
    set -euo pipefail
    for svc in fitness-tracker.service fitness-tracker-backup.service; do
      sed -e "s|__USER__|$(id -un)|g" -e "s|__HOME__|$HOME|g" "systemd/$svc" \
        | sudo tee "/etc/systemd/system/$svc" >/dev/null
    done
    sudo cp systemd/fitness-tracker-backup.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    echo ">> Installed units for user $(id -un) (home $HOME)"

# (Run on the Linux server) Enable + start the app service and the backup timer.
systemd-enable:
    sudo systemctl enable --now fitness-tracker.service
    sudo systemctl enable --now fitness-tracker-backup.timer

# (Run on the Linux server) Restart the app to pick up new code after a deploy.
systemd-restart:
    sudo systemctl restart fitness-tracker.service
    systemctl status fitness-tracker.service --no-pager

# (Run on the Linux server) Show status of both units.
systemd-status:
    systemctl status fitness-tracker.service --no-pager
    systemctl status fitness-tracker-backup.timer --no-pager

# (Run on the Linux server) ONE-SHOT full setup: deps + native build + units +
# enable + a test backup. Run after `just deploy` from your dev machine.
# Requires a filled `.env` already on the server (scp it first).
server-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}"

    # 1. .env must exist and be non-empty (the daily backup dies without it).
    if [ ! -s .env ]; then
      echo "ERROR: .env is missing or empty at $(pwd)/.env" >&2
      echo "       Copy it from your dev machine first:" >&2
      echo "         scp .env <user>@<server>:$(pwd)/.env" >&2
      exit 1
    fi
    chmod 600 .env
    echo ">> .env present ($(grep -c '=' .env) keys)"

    # 2. Install deps.
    echo ">> npm install"
    npm install

    # 3. Ensure the better-sqlite3 native binary exists for THIS Node ABI.
    #    `npm install` can skip/no-op the build; force a source build if so.
    if ! find node_modules/better-sqlite3 -name '*.node' | grep -q .; then
      echo ">> better-sqlite3 binary missing -> building from source"
      ( cd node_modules/better-sqlite3 && npm run build-release )
    fi
    echo ">> better-sqlite3 binary: $(find node_modules/better-sqlite3 -name '*.node' | head -1)"

    # 4. Install systemd units (substitutes __USER__/__HOME__) + reload.
    just systemd-install

    # 5. Enable + start the app and the daily backup timer.
    echo ">> enabling app + backup timer"
    sudo systemctl enable --now fitness-tracker.service
    sudo systemctl enable --now fitness-tracker-backup.timer

    # 6. Run one backup now to prove creds + region + upload work.
    echo ">> test backup run"
    sudo systemctl start fitness-tracker-backup.service
    journalctl -u fitness-tracker-backup.service -n 15 --no-pager

    echo ""
    echo ">> DONE."
    echo "   App:     systemctl status fitness-tracker.service"
    echo "   Backups: systemctl list-timers fitness-tracker-backup.timer"
