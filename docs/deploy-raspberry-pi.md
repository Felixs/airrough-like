# Deploy to a Raspberry Pi (home network)

**Simplest:** the released images are public and multi-arch, so no GitLab setup is needed:

```bash
docker run -d -p 8080:80 --restart unless-stopped --name airport-auto-battler ghcr.io/felixs/airrough-like:latest
```

`latest` follows the newest release; pin a version with e.g. `:0.1.0`. The GitLab setup below is only for getting the
newest build of every `main` push before it is released.

Every push to `main` that passes CI builds a Docker image (nginx serving the built game, for `linux/arm64` and `linux/amd64`) and pushes it to a private GitLab Container Registry. The Pi pulls it from there and serves the game on port 8080.

## One-time setup

### 1. GitLab: a project for the image and a deploy token

1. Create an empty private GitLab project, e.g. `airport-auto-battler`. It only holds the image.
2. In that project, go to **Settings → Repository → Deploy tokens** and create a token:
   - name: `github-ci`
   - scopes: `read_registry` and `write_registry`
3. Note the token's **username** and **token**.
4. Note the registry path shown under **Deploy → Container Registry**, e.g. `registry.gitlab.com/<namespace>/airport-auto-battler`.

### 2. GitHub: secrets and a variable

In this GitHub repo, go to **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `GITLAB_REGISTRY_USER` | deploy token username |
| Secret | `GITLAB_REGISTRY_TOKEN` | deploy token |
| Variable | `GITLAB_IMAGE` | registry path, e.g. `registry.gitlab.com/<namespace>/airport-auto-battler` (no tag) |

Until `GITLAB_IMAGE` is set, CI skips the image job. Once it's set, re-run the latest `main` workflow or push to `main`.

### 3. Raspberry Pi (64-bit Raspberry Pi OS, Docker installed)

Create a second GitLab deploy token for the Pi with only `read_registry`. Then:

```bash
mkdir -p ~/airport && cd ~/airport
# copy deploy/docker-compose.yml from this repo into this folder, then:
echo "IMAGE=registry.gitlab.com/<namespace>/airport-auto-battler:latest" > .env
docker login registry.gitlab.com -u <pi-token-username>   # paste the token as password
docker compose up -d
```

Open `http://<pi-hostname-or-ip>:8080` from any device on your home network.

## Updating

```bash
cd ~/airport && docker compose pull && docker compose up -d
```

To update automatically, run [Watchtower](https://containrrr.dev/watchtower/) on the Pi. It checks for a new `:latest` image and restarts the container when it finds one.

## Run it on a PC

```bash
docker build -t airport-auto-battler . && docker run --rm -p 8080:80 airport-auto-battler
```
