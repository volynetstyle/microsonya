# Microsonya Web Mini App

Solid 2 Telegram Mini App for reading chat summaries and their source
messages.

## Development

Run the Vite UI separately when working on visual states:

```sh
pnpm --dir apps/cloudflare/src/wma dev
```

The development build includes lightweight URL fixtures that act as visual
stories without shipping Storybook or fixture data to production:

| State   | Home                | Chat                                     |
| ------- | ------------------- | ---------------------------------------- |
| Loaded  | `/?fixture=demo`    | `/chat?ref=product-team&fixture=demo`    |
| Loading | `/?fixture=loading` | `/chat?ref=product-team&fixture=loading` |
| Empty   | `/?fixture=empty`   | `/chat?ref=empty&fixture=empty`          |
| Error   | `/?fixture=error`   | `/chat?ref=product-team&fixture=error`   |

The production build removes both the dynamic fixture module and its sample
content. Run `pnpm --filter @microsonya/telegram-wma build` to verify the final
bundle.
