# Accord of Stars

A turn-based space 4X that runs in the browser. The design is in `DESIGN.md`; the working rules for the code are in `CLAUDE.md`.

## Play

- **Online:** every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/deploy.yml`.
- **On this machine:** `npm install`, then `npm run dev`, and open http://localhost:5173.

In the game, press **H** for how to play and the keyboard shortcuts.

## Host it yourself

The game is a static site: there is no server to run and nothing to configure. Asset paths are relative, so it works from a domain root, a sub-folder or a file share.

1. Build it:

   ```bash
   npm install
   ```

   ```bash
   npm run build
   ```

2. Serve the `dist/` folder with any web server. Three ways:

   - **Straight from this folder,** reachable from other devices on your network at port 4173:

     ```bash
     npm run preview -- --host
     ```

   - **Docker with nginx,** at port 8080 (run from the project folder):

     ```bash
     docker run -d --name accord -p 8080:80 -v "$PWD/dist:/usr/share/nginx/html:ro" nginx:alpine
     ```

   - **An existing web server:** copy the contents of `dist/` into any folder it serves.

3. To update, pull, build again and replace the files. With the Docker command above the container serves the new build at once.

### Things to know

- **Saves stay in the browser.** The autosave and the three save slots are kept per browser and per address, so a game saved at `http://server:8080` is not visible at another address or on another device. Use **Save → Download save file** to move a game, and **Load save file** on the main menu to bring it in.
- **It must be served over http or https.** Opening `dist/index.html` directly from disk does not work, because browsers will not load the game's script modules from a `file://` address.
- **No accounts and no network calls.** Once the page has loaded, the game plays without a connection.

## Develop

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | All tests (about a minute) |
| `npm run build` | Typecheck and build into `dist/` |
| `npm run headless -- --seed 1 --turns 500 --preset small` | Play an AI-vs-AI game with no screen |
| `npm run balance -- --games 1000 --jobs 10` | The five-power balance report |
