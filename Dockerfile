FROM node:18
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Install TypeScript globally
RUN npm install -g typescript

# Expose the port the app runs on
EXPOSE 8080

RUN yarn build

# Define the command to run the compiled app
CMD ["node", "./dest/index.js"]