/**
 * Script de Inyección Segura de Variables de Entorno
 * ==================================================
 * Lee credenciales desde:
 * 1. Variables de entorno del sistema (SUPABASE_URL, SUPABASE_KEY)
 * 2. Archivo local .env o .env.local (si existe)
 * 
 * Genera de forma segura los archivos locales excluidos de Git:
 * - src/environments/environment.ts
 * - src/environments/environment.prod.ts
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const envDir = path.join(rootDir, 'src', 'environments');

// 1. Cargar archivo .env o .env.local si existe
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const vars = {};
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
  });
  return vars;
}

const dotEnv = {
  ...loadDotEnv(path.join(rootDir, '.env')),
  ...loadDotEnv(path.join(rootDir, '.env.local')),
};

const supabaseUrl = process.env.SUPABASE_URL || dotEnv.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || dotEnv.SUPABASE_KEY;

if (!fs.existsSync(envDir)) {
  fs.mkdirSync(envDir, { recursive: true });
}

// 2. Generar environment.ts (Desarrollo)
const devContent = `// Autogenerado por scripts/set-env.js — NO SUBIR A GIT
export const environment = {
  production: false,
  supabaseUrl: '${supabaseUrl}',
  supabaseKey: '${supabaseKey}',
};
`;

// 3. Generar environment.prod.ts (Producción)
const prodContent = `// Autogenerado por scripts/set-env.js — NO SUBIR A GIT
export const environment = {
  production: true,
  supabaseUrl: '${supabaseUrl}',
  supabaseKey: '${supabaseKey}',
};
`;

fs.writeFileSync(path.join(envDir, 'environment.ts'), devContent, 'utf-8');
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), prodContent, 'utf-8');

console.log('✓ Entornos generados con éxito en src/environments/ (protegidos por .gitignore)');
