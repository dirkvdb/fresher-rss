# syntax=docker/dockerfile:1
ARG FRESHRSS_IMAGE=freshrss/freshrss:latest
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS node-runtime

# Add the reader to the official FreshRSS image, served at /reader/.
# Set FRESHRSS_IMAGE to your current official FreshRSS tag when upgrading.
FROM ${FRESHRSS_IMAGE} AS freshrss
ENV FRESHRSS_URL=http://127.0.0.1
COPY --from=build /app/dist/ /var/www/FreshRSS/p/reader/
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app/dist-server/ /opt/fresher/
COPY docker/fresher.Apache.conf /etc/apache2/conf-available/fresher.conf
RUN a2enmod proxy proxy_http && a2enconf fresher
COPY --chmod=755 docker/freshrss-entrypoint.sh /usr/local/bin/fresher-entrypoint
ENTRYPOINT ["/usr/local/bin/fresher-entrypoint"]
CMD ([ -z "$CRON_MIN" ] || cron) && \
    . /etc/apache2/envvars && \
    exec apache2 -D FOREGROUND $([ -n "$OIDC_ENABLED" ] && [ "$OIDC_ENABLED" -ne 0 ] && echo "-D OIDC_ENABLED")

# A standalone companion with a fixed-upstream, same-origin API proxy.
FROM nginx:stable-alpine AS standalone
RUN apk add --no-cache nodejs
ENV FRESHRSS_URL=http://freshrss FRESHER_API_URL=/freshrss-api
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY docker/default.conf.template /opt/fresher/nginx.conf.template
COPY --from=build /app/dist-server/ /opt/fresher/
COPY --chmod=755 docker/40-start-images.sh /docker-entrypoint.d/40-start-images.sh
EXPOSE 80
