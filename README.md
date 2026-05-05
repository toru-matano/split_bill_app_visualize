This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Phase 3 features

### Multi-currency
Each expense can be logged in any of 12 supported currencies. The app fetches live rates from [frankfurter.app](https://frankfurter.app) (free, no API key). Rates are cached in memory for 1 hour. The converted base-currency amount is stored in `expenses.amount` for settlement; the original currency/amount/rate are stored separately for display.

### Categories
Expenses are tagged with one of 6 categories: Food & Drink 🍜, Transport 🚆, Hotel 🏨, Activities 🎡, Shopping 🛍️, Other 💳. The group home shows category filter chips when 2+ categories are used. The summary page shows a bar chart breakdown by category.

### Trip summary
`/group/[token]/summary` shows:
- Total spent + per-person average
- Category breakdown with progress bars
- Per-member contribution with over/under indicator
- Minimum settlement transfers
- Full expense list

The "Copy as text" button formats all of the above as plain text for pasting into a group chat.

### Ads (Google AdSense)
The `AdBanner` component in `app/group/[token]/page.tsx` is a placeholder. To activate real ads:

1. Sign up at [Google AdSense](https://adsense.google.com)
2. Add your publisher script to `app/layout.tsx`:
   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossOrigin="anonymous" />
   ```
3. Replace the placeholder `<div>` in `AdBanner` with your `<ins>` tag:
   ```html
   <ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
     data-ad-slot="XXXXXXXXXX"
     data-ad-format="auto"
     data-full-width-responsive="true" />
   ```
4. Call `(adsbygoogle = window.adsbygoogle || []).push({})` after mount.

Keep the ad below the action buttons — never in the settlement screen.
