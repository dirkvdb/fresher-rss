{ pkgs, ... }:

{
  packages = [
    pkgs.git
    pkgs.just
    pkgs.docker-client
    pkgs.docker-compose
    pkgs.chromium
    pkgs.actionlint
    pkgs.gh
  ];

  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
  };

  scripts = {
    setup.exec = "npm ci";
    dev.exec = "npm run dev";
    build.exec = "npm run build";
    images.exec = "npm run start:images";
    check.exec = "npm test && npm run test:browser && npm run build";
    image.exec = "docker build --target standalone -t fresher-rss .";
    image-freshrss.exec = "docker build --target freshrss -t freshrss-with-fresher .";
  };

  processes.web.exec = "npm run dev";

  enterShell = ''
    echo "Fresher RSS — setup · dev · build · check · images · image · image-freshrss"
  '';

  enterTest = ''
    npm ci
    npm test
    npm run test:browser
    npm run build
  '';
}
