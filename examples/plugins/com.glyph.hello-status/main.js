// The smallest useful Glyph plugin. The entry file is a plain ES module that
// default-exports `{ activate }`; Glyph calls it with the plugin context and
// automatically tears down everything you registered when the plugin unloads.
export default {
  activate(ctx) {
    let greets = 0;

    // A live region in the status bar (visible while a document is open).
    ctx.ui.addStatusBarItem({
      id: "hello-status.item",
      mount(el, registerCleanup) {
        el.textContent = "Hi from a plugin";
        const timer = setInterval(() => {
          if (greets > 0) el.textContent = `Greeted ${greets}x`;
        }, 1000);
        registerCleanup(() => clearInterval(timer));
      },
    });

    // A command, findable in the palette (Cmd/Ctrl+K) under "Commands".
    ctx.commands.register({
      id: "hello-status.greet",
      title: "Hello Plugin: Greet",
      run() {
        greets += 1;
        ctx.notify(`Hello from the sample plugin! (plugin API ${ctx.apiVersion})`);
      },
    });
  },
};
