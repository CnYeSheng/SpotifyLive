# Deployment Guide - Spotify Lyrics Player 2.0

## Vercel Deployment (Recommended)

### Prerequisites
- GitHub account and repository
- Vercel account
- Spotify Developer credentials
- Genius API token (optional)

### Step 1: Prepare Repository

```bash
# Make sure you're on the 2.0 branch
git checkout 2.0

# Push to GitHub
git push origin 2.0
```

### Step 2: Create Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Select the `2.0` branch
5. Configure build settings:
   - **Build Command**: `pnpm run build`
   - **Output Directory**: `dist/public`
   - **Install Command**: `pnpm install`

### Step 3: Set Environment Variables

In Vercel Project Settings → Environment Variables, add:

```
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=https://your-domain.vercel.app/callback
VITE_SPOTIFY_REDIRECT_URI=https://your-domain.vercel.app/callback
GENIUS_API_TOKEN=your_genius_api_token
DOMAIN=your-domain.vercel.app
NODE_ENV=production
```

### Step 4: Update Spotify Redirect URI

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Edit your application settings
3. Add new Redirect URI: `https://your-domain.vercel.app/callback`
4. Save changes

### Step 5: Deploy

- Vercel will automatically deploy when you push to the `2.0` branch
- Check deployment status in Vercel dashboard
- Your app will be available at `https://your-domain.vercel.app`

## Docker Deployment

### Build Docker Image

```dockerfile
# Create Dockerfile in project root
FROM node:18-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN pnpm run build

# Expose port
EXPOSE 3000

# Start application
CMD ["pnpm", "run", "start"]
```

### Build and Run

```bash
# Build image
docker build -t spotify-lyrics:2.0 .

# Run container
docker run -p 3000:3000 \
  -e SPOTIFY_CLIENT_ID=your_client_id \
  -e SPOTIFY_CLIENT_SECRET=your_client_secret \
  -e REDIRECT_URI=http://localhost:3000/callback \
  -e GENIUS_API_TOKEN=your_token \
  spotify-lyrics:2.0
```

## Self-Hosted Deployment (Linux/VPS)

### Prerequisites
- Linux server with Node.js 18+
- pnpm installed globally
- Domain with SSL certificate
- Nginx or similar reverse proxy

### Step 1: Clone Repository

```bash
git clone <your-repo-url> spotify-lyrics
cd spotify-lyrics
git checkout 2.0
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Build Application

```bash
pnpm run build
```

### Step 4: Create Environment File

```bash
cat > .env.production << EOF
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
REDIRECT_URI=https://your-domain.com/callback
GENIUS_API_TOKEN=your_token
DOMAIN=your-domain.com
NODE_ENV=production
PORT=3001
EOF
```

### Step 5: Create Systemd Service

```bash
sudo tee /etc/systemd/system/spotify-lyrics.service > /dev/null << EOF
[Unit]
Description=Spotify Lyrics Player
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/home/username/spotify-lyrics
ExecStart=/usr/local/bin/pnpm run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable spotify-lyrics
sudo systemctl start spotify-lyrics
```

### Step 6: Configure Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### Step 7: Reload Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## AWS EC2 Deployment

### Step 1: Launch EC2 Instance

- AMI: Ubuntu 22.04 LTS
- Instance Type: t3.small (minimum)
- Storage: 20GB SSD
- Security Group: Allow SSH (22), HTTP (80), HTTPS (443)

### Step 2: Connect and Setup

```bash
# SSH into instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install Git
sudo apt install -y git
```

### Step 3: Deploy Application

Follow the "Self-Hosted Deployment" steps above

## Environment Variables Checklist

- [ ] `SPOTIFY_CLIENT_ID` - From Spotify Developer Dashboard
- [ ] `SPOTIFY_CLIENT_SECRET` - From Spotify Developer Dashboard
- [ ] `REDIRECT_URI` - Match your deployment URL
- [ ] `VITE_SPOTIFY_CLIENT_ID` - Same as SPOTIFY_CLIENT_ID
- [ ] `VITE_SPOTIFY_REDIRECT_URI` - Same as REDIRECT_URI
- [ ] `GENIUS_API_TOKEN` - From Genius API (optional)
- [ ] `DOMAIN` - Your deployment domain
- [ ] `NODE_ENV` - Set to "production"
- [ ] `PORT` - Default 3000

## Health Checks

After deployment, verify:

```bash
# Check application health
curl https://your-domain.com/health

# Expected response:
# {"status":"ok","timestamp":"2024-01-01T12:00:00.000Z"}

# Check API health
curl https://your-domain.com/api/spotify/health
curl https://your-domain.com/api/lyrics/health
```

## Monitoring

### Logs

**Vercel**: Check deployment logs in dashboard

**Self-hosted**:
```bash
# View service logs
sudo journalctl -u spotify-lyrics -f

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## Troubleshooting

### Application Won't Start
```bash
# Check Node.js version
node --version  # Should be 18.0.0+

# Check environment variables
echo $SPOTIFY_CLIENT_ID

# Run with debug logging
DEBUG=* pnpm run start
```

### Authentication Fails
- Verify Spotify redirect URI matches exactly
- Check credentials are correct
- Clear browser cookies and try again

### Performance Issues
- Enable caching headers in Nginx
- Use CDN for static assets
- Monitor server resources

## Rollback

### Vercel
- Go to Vercel Dashboard
- Select Deployments
- Click "Rollback" on previous deployment

### Self-hosted
```bash
# Revert to previous commit
git checkout <previous-commit-hash>

# Rebuild
pnpm run build

# Restart service
sudo systemctl restart spotify-lyrics
```

## SSL/TLS Certificate

### Let's Encrypt (Free)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --nginx -d your-domain.com

# Auto-renewal
sudo systemctl enable certbot.timer
```

## Performance Optimization

### Frontend
- Static assets cached for 1 day
- Gzip compression enabled
- Code splitting with Vite
- Lazy loading of components

### Backend
- Connection pooling
- Lyrics caching (24 hours TTL)
- Request timeout: 5 seconds

## Monitoring Checklist

- [ ] Application responding to requests
- [ ] Authentication working correctly
- [ ] Spotify API integration functional
- [ ] Lyrics search working
- [ ] Recent tracks displaying
- [ ] Error handling working
- [ ] Performance acceptable
- [ ] SSL certificate valid

## Support

For deployment issues:
1. Check environment variables
2. Review logs for errors
3. Verify Spotify credentials
4. Test with curl/Postman
5. Create GitHub issue if needed

## Next Steps

After successful deployment:
1. Monitor application for errors
2. Collect user feedback
3. Plan feature updates
4. Consider implementing:
   - User preferences/settings
   - Playlist support
   - Advanced lyrics features
   - Social sharing
