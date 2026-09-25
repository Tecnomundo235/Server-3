# Guía de Migración y Despliegue a VPS DigitalOcean (Bibi Store)

Servidor detectado según tu captura de pantalla:
- **Proveedor:** DigitalOcean
- **Droplet:** `ubuntu-s-1vcpu-1gb-nyc1`
- **Sistema Operativo:** Ubuntu 24.04 (LTS) x64
- **IP Pública:** `64.227.15.171`
- **Recursos:** 1 vCPU, 1 GB RAM

---

## 🚀 Método Rápido: Conexión mediante Web Console (DigitalOcean)

No necesitas instalar programas de terminal en tu celular o computadora. Puedes usar la consola web directa de DigitalOcean:

1. En tu panel de DigitalOcean (donde tomaste la captura), presiona el botón **"Web Console"** (el botón gris al lado de *Actions*).
2. Se abrirá una terminal negra con acceso `root@ubuntu-s-1vcpu-1gb-nyc1:~#`.

---

## 🛠️ Opción 1: Despliegue Nativo con Nginx (Recomendado para 1GB RAM)

Nginx consume únicamente **~15MB de memoria RAM**, dejando los 985MB restantes completamente libres para el sistema y las visitas.

### Paso 1: Clonar o descargar el código en el servidor
Si tienes el proyecto en un repositorio Git (GitHub/GitLab):
```bash
git clone <TU_URL_DE_GITHUB> /var/www/bibi-store
cd /var/www/bibi-store
```

O si vas a subir los archivos por SFTP/SCP:
```bash
# Desde tu PC o terminal local:
scp -r * root@64.227.15.171:/var/www/bibi-store/
```

### Paso 2: Ejecutar el script automático
Una vez dentro de la carpeta `/var/www/bibi-store`:
```bash
chmod +x deploy-vps.sh
sudo ./deploy-vps.sh
```

El script configurará:
1. 1 GB de memoria Swap para evitar fallos de memoria durante `npm install` o `npm run build`.
2. Node.js 20 LTS.
3. Servidor Web Nginx con soporte para Single Page Applications (React Router) y PWA.
4. Firewall UFW permitiendo tráfico en puertos 80 y 443.
5. Inicia el servicio automáticamente.

---

## 🐳 Opción 2: Despliegue con Docker y Docker Compose

Si prefieres usar contenedores:

```bash
# 1. Instalar Docker y Compose en Ubuntu 24.04
sudo apt update && sudo apt install -y docker.io docker-compose

# 2. Iniciar el contenedor de Bibi Store
docker-compose up -d --build
```

---

## 🔒 Paso Fundamental: Autorizar la IP en Firebase

Para que el inicio de sesión con Google (`signInWithPopup`) funcione en tu nueva VPS:

1. Ingresa a la **[Consola de Firebase](https://console.firebase.google.com/)**.
2. Selecciona tu proyecto (`gen-lang-client-0621684486`).
3. Ve a **Authentication** (Autenticación) en el menú lateral izquierdo.
4. Haz clic en la pestaña **Settings** (Configuración) -> **Authorized domains** (Dominios autorizados).
5. Haz clic en **Add domain** (Agregar dominio) y escribe:
   ```text
   64.227.15.171
   ```
6. Haz clic en Guardar. Si compras un dominio propio (por ejemplo `bibistore.com`), también debes agregarlo allí.

---

## 🌐 Configuración de Dominio Propio y Certificado SSL Gratuito (HTTPS)

Cuando vincules un dominio a la IP `64.227.15.171` (por ejemplo en Namecheap, GoDaddy, Cloudflare):

1. Modifica `/etc/nginx/sites-available/bibi-store` reemplazando `64.227.15.171` por `tudominio.com`.
2. Instala Certbot y genera el certificado SSL automático con un solo comando:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d tudominio.com -d www.tudominio.com
   ```
Certbot configurará HTTPS automáticamente y renovará los certificados cada 90 días sin que tengas que intervenir.
