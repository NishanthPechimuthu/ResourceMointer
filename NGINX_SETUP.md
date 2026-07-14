# =============================================================================
# NP Security Engine — Nginx Configuration Guide
# =============================================================================
#
# PROBLEM: nginx-bans.conf is only effective if included in your nginx site config.
# If it is NOT included, IP blocking will NEVER work regardless of what's in the file.
#
# STEP 1: Add this line to your nginx server {} block (inside the http block or server block):
#
#   include /path/to/NP-Dashboard/nginx-bans.conf;
#
# Example /etc/nginx/sites-available/yoursite.conf:
# -------------------------------------------------------
# server {
#     listen 80;
#     server_name yourdomain.com;
#
#     # === NP Security Engine: Auto-generated IP bans ===
#     include /var/www/NP-Dashboard/nginx-bans.conf;
#     # ===================================================
#
#     location / {
#         proxy_pass http://localhost:2809;
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#         proxy_set_header X-Forwarded-Proto $scheme;
#     }
# }
#
# STEP 2: Make sure your Node app reads the real client IP:
#   In app.js: app.set('trust proxy', 1);  ← already done ✅
#   In nginx: proxy_set_header X-Real-IP $remote_addr;  ← must be set
#
# STEP 3: Verify the include path matches NGINX_BANS_FILE in your .env:
#   Add to .env: NGINX_BANS_FILE=/var/www/NP-Dashboard/nginx-bans.conf
#
# STEP 4: Test nginx reads the bans file:
#   sudo nginx -t
#   sudo nginx -s reload
#
# STEP 5: Verify sudo works without password for nginx reload:
#   Add to /etc/sudoers (via: sudo visudo):
#   www-data ALL=(ALL) NOPASSWD: /usr/sbin/nginx
#   (replace www-data with the user running your Node process)
#
# =============================================================================
