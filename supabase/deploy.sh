#!/usr/bin/env bash
# Sube el servidor del juego (Edge Function "brotes") a Supabase.
# Usa el mismo motor de reglas que el navegador (js/engine.js).
# Necesita un token de acceso de Supabase en SUPABASE_ACCESS_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${SUPABASE_PROJECT_REF:-uyzalwnhuqagxeqseziv}"
TOKEN="${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
curl -sS --fail-with-body -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"brotes","verify_jwt":false};type=application/json' \
  -F "file=@supabase/functions/brotes/index.ts;filename=index.ts;type=application/typescript" \
  -F "file=@js/engine.js;filename=engine.js;type=application/javascript" \
  "https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=brotes"
echo
