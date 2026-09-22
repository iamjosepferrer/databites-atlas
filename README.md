# databites-atlas

Interactive socio-economic atlas for Catalonia: income, inequality and demographics at census tract level.

→ **[catalonia-atlas.databites.tech](https://catalonia-atlas.databites.tech)**

## Structure

```
pipeline/   Python pipeline that downloads INE data and writes web/geo and web/data
web/        The static site: index.html, js/, css/, geo/, data/
wrangler.jsonc   Cloudflare deploy config (serves ./web as static assets)
```

## Update the data

```bash
cd pipeline
pip install -r requirements.txt
python run.py
```

The export writes minified JSON and 6-decimal coordinates, and fails loudly if any file goes over Cloudflare's 25 MiB per-file limit.

## Deploy

Cloudflare Workers with static assets, connected to this repo. Every push to `main` redeploys. No build step.

Manual deploy: `npx wrangler deploy`
