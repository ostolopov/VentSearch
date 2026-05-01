# Deploy to Yandex Cloud VM (autodeploy)

## 1) Prepare VM once

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg nginx

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker

# Nginx
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/sites-available/ventsearch.conf >/dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/ventsearch.conf /etc/nginx/sites-enabled/ventsearch.conf
sudo nginx -t
sudo systemctl restart nginx

mkdir -p "$HOME/apps/ventsearch"
```

## 2) GitHub repository secrets

Add these secrets in GitHub Actions:

- `VM_HOST` - public IP of the VM
- `VM_USER` - VM username (for example, `ubuntu`)
- `VM_SSH_PORT` - usually `22`
- `VM_SSH_KEY` - private SSH key content used by Actions to connect to VM
- `POSTGRES_DB` - database name (`ventmash`)
- `POSTGRES_USER` - database user
- `POSTGRES_PASSWORD` - strong database password
- `CORS_ORIGINS` - comma-separated origins for frontend

## 3) How deployment works

Workflow file: `.github/workflows/deploy-vm.yml`

On every push to `main`:

1. Copy repository to VM (`~/apps/ventsearch`)
2. Generate `.env.prod` from GitHub secrets
3. Run:
   ```bash
   docker compose --env-file .env.prod -f compose.prod.yml up -d --build
   ```
4. Validate app health by `http://127.0.0.1:8080/api/health`

## 4) Useful VM commands

```bash
cd ~/apps/ventsearch
docker compose --env-file .env.prod -f compose.prod.yml ps
docker compose --env-file .env.prod -f compose.prod.yml logs -f --tail=200
docker compose --env-file .env.prod -f compose.prod.yml restart app
```
