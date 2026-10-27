FROM node:20-bullseye-slim

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --only=production

COPY . .

# Render exposes the port via the PORT environment variable
EXPOSE 3000

CMD ["npm", "start"]
