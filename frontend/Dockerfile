FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Copy application code
COPY . .

# Build Next.js for production
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
