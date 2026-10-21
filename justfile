default:
    @just --list

# Install locked dependencies and run the frontend at http://localhost:5173.
run:
    npm ci
    npm run dev

# Create the static production build in dist/.
build:
    npm ci
    npm run build

# Run API/content tests and the TypeScript production build.
check:
    npm ci
    npm test
    npm run test:browser
    npm run build

# Check desktop/mobile reader interactions in Chromium.
test-browser:
    npm run test:browser

# Build the companion web container.
image:
    docker build --target standalone -t fresher-rss-standalone .

# Build FreshRSS with the alternative interface at /reader/.
image-freshrss:
    docker build --target freshrss -t fresher-rss .

# Run the companion on the existing FreshRSS Docker network.
up:
    docker compose up -d --build

# Run the built image service on loopback port 3001.
images:
    npm run start:images
