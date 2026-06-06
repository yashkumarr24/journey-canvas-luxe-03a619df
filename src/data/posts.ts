import blogHero from "@/assets/blog-hero.jpg";

export type Section = { heading: string; body: string };

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  date: string;
  read: string;
  cover: string;
  intro: string;
  sections: Section[];
  faqs: { q: string; a: string }[];
};

export const posts: Post[] = [
  {
    slug: "best-time-to-travel-internationally",
    title: "Best Time to Travel Internationally — Top Destinations by Month",
    excerpt:
      "A month‑by‑month guide to where in the world is at its very best — from January in Vietnam to Christmas in Dubai.",
    author: "Bhaumik",
    date: "July 3, 2024",
    read: "9 min",
    cover: blogHero,
    intro:
      "Here is a curated, month‑by‑month guide to the best places to travel internationally. We've grouped destinations by the months in which weather, festivals and value are at their peak — so you can plan your year with confidence and get genuine value from every trip.",
    sections: [
      {
        heading: "January",
        body: "Egypt is at its most pleasant — comfortable Nile cruises and shaded temple walks. New Zealand is in full summer with long, dry days. Kenya and Tanzania are lush and green after the rains, and Vietnam is enjoying some of its best weather of the year.",
      },
      {
        heading: "February",
        body: "Everything that worked in January, plus Brazil's Carnival, Morocco at its best, Thailand for beaches and Kerala for backwaters. Sri Lanka and Malaysia are both pleasant and excellent value.",
      },
      {
        heading: "March",
        body: "Add Darjeeling, the Maldives, Florida and California — all in their settled, pre‑summer window. Canada is also exceptional in March, with crisp blue skies before the snowmelt.",
      },
      {
        heading: "April",
        body: "A particularly elegant month for Europe, North America, China and Thailand. Closer home, Himachal Pradesh sees spring blossoms across the apple orchards.",
      },
      {
        heading: "May",
        body: "Alaska cruises run without the high‑season crowds. Italy and Bali peak. Himachal stays cool while the rest of north India warms up.",
      },
      {
        heading: "June",
        body: "Europe river cruises are at their best — long evenings and short queues. Kenya's great migration begins, and Kashmir bursts into flower. Switzerland is mild and Hong Kong is at its prettiest.",
      },
      {
        heading: "July",
        body: "Mauritius has settled weather, Mt. Kailash season opens, Europe is busy but vibrant, and Australia is a fine winter‑sun escape.",
      },
      {
        heading: "August",
        body: "Scotland, Scandinavia and Fiji are all at their peak. Long, quiet evenings in the north — and warm clear water in the Pacific.",
      },
      {
        heading: "September",
        body: "Italy stays beautiful but quieter. Canada and the USA enter low season — uncrowded parks and excellent rates. Switzerland is calm and China is gentle.",
      },
      {
        heading: "October",
        body: "Hong Kong is excellent. Turkey, Nepal and Greece offer low‑season prices with great weather — one of the most underrated travel months of the year.",
      },
      {
        heading: "November",
        body: "Australia opens its summer, South Africa is pleasant, and Egypt is at its sunniest for a Nile cruise.",
      },
      {
        heading: "December",
        body: "Dubai for Christmas markets and sky‑high dinners, Thailand for beaches, the Maldives for warm‑water indulgence, and Singapore for Universal Studios' special Christmas shows.",
      },
    ],
    faqs: [
      {
        q: "What's the cheapest month to fly internationally?",
        a: "It depends on the destination's season. As a rule, booking six months in advance significantly improves your fare — and travelling in shoulder months (March–May or September–November) keeps prices and crowds lower.",
      },
      {
        q: "Which season is best for international travel?",
        a: "Summer is best for colder destinations in the north (Europe, Canada, Scandinavia). For warmer destinations near the equator (Dubai, India, South Africa), winter is the most comfortable season.",
      },
      {
        q: "What is the most expensive month to fly internationally?",
        a: "December — particularly the two weeks bracketing Christmas and New Year — is consistently the most expensive period to fly.",
      },
    ],
  },
];

export const getPost = (slug: string) => posts.find((p) => p.slug === slug);
