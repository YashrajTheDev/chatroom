# Use an official Node.js runtime as the base image
FROM node:20-slim

# Create and set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install project dependencies
RUN npm install

# Bundle your app's source code inside the container
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "server.js" ]
