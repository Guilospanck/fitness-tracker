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

# (Run on the Linux server) Copy unit files into /etc/systemd/system/ and reload.
systemd-install:
    sudo cp systemd/fitness-tracker.service systemd/fitness-tracker-backup.service systemd/fitness-tracker-backup.timer /etc/systemd/system/
    sudo systemctl daemon-reload

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
