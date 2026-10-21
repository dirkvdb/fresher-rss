import { ALL, READ, STARRED, type Article, type Feed } from "./api";

const folder = (name: string) => ({ id: `user/-/label/${name}`, label: name });
export const demoFeeds: Feed[] = [
  {
    id: "feed/1",
    title: "The Browser",
    categories: [folder("The good stuff")],
  },
  {
    id: "feed/2",
    title: "Dense Discovery",
    categories: [folder("The good stuff")],
  },
  { id: "feed/3", title: "Aeon", categories: [folder("The good stuff")] },
  { id: "feed/4", title: "Hacker News", categories: [folder("Technology")] },
  { id: "feed/5", title: "The Verge", categories: [folder("Technology")] },
  {
    id: "feed/6",
    title: "Simon Willison’s Weblog",
    categories: [folder("Technology")],
  },
  { id: "feed/7", title: "CSS-Tricks", categories: [folder("Design & craft")] },
  {
    id: "feed/8",
    title: "A List Apart",
    categories: [folder("Design & craft")],
  },
  { id: "feed/9", title: "Dezeen", categories: [folder("Design & craft")] },
];
const stories: [string, number, string, string][] = [
  [
    "The quiet pleasure of paying attention",
    1,
    "Maya Ellis",
    "There is a particular kind of clarity that arrives when we stop trying to keep up with everything. A small case for a more intentional relationship with the things we read.",
  ],
  [
    "A smaller, more thoughtful internet",
    2,
    "Kai Brach",
    "On personal websites, digital gardens, and making room for the wonderfully ordinary.",
  ],
  [
    "What we lose when we stop getting lost",
    3,
    "Sophie McBain",
    "Wandering is more than a way to get somewhere. It is a way of noticing what is already here.",
  ],
  [
    "Show HN: A tiny computer with a very long battery life",
    4,
    "",
    "A weekend project about doing more with less, built one component at a time.",
  ],
  [
    "The web still belongs to all of us",
    5,
    "David Pierce",
    "The next chapter of the internet might look a lot more like its first.",
  ],
  [
    "Notes on building things that last",
    6,
    "Simon Willison",
    "A few lessons from maintaining small, useful software over the years.",
  ],
  [
    "Good design leaves a little room to breathe",
    8,
    "A List Apart",
    "Whitespace is not what is left over. It is an essential part of the conversation.",
  ],
  [
    "A house built around an old olive tree",
    9,
    "Amy Frearson",
    "A quiet courtyard and a different approach to bringing the outdoors in.",
  ],
  [
    "The surprisingly useful details of modern CSS",
    7,
    "Geoff Graham",
    "A closer look at the little improvements that make the web feel better.",
  ],
  [
    "In praise of the unfinished notebook",
    1,
    "Oliver Burkeman",
    "Some things are worth doing even when they are never going to be complete.",
  ],
  [
    "Learning to see the familiar differently",
    3,
    "Mina Cikara",
    "Curiosity is a practice, and the everyday world is a good place to begin.",
  ],
  [
    "A field guide to doing one thing at a time",
    2,
    "Kai Brach",
    "Fewer tabs. Longer thoughts. A small invitation to slow down.",
  ],
];
export function makeDemo(): Article[] {
  return stories.map(([title, feedId, author, excerpt], i) => {
    const feed = demoFeeds.find((f) => f.id === `feed/${feedId}`)!;
    return {
      id: `demo-${i}`,
      title,
      author,
      published: Math.floor(Date.now() / 1000) - (i * 3700 + 1800),
      categories: [
        ALL,
        ...feed.categories.map((c) => c.id),
        ...(i > 8 ? [READ] : []),
        ...(i === 2 || i === 6 ? [STARRED] : []),
      ],
      origin: { streamId: feed.id, title: feed.title },
      summary: {
        content: `<p>${excerpt}</p><p>Every morning, there is more to read than the morning can possibly hold. The headlines arrive, the newsletters pile up, and somewhere in the middle of it all, we forget what brought us here in the first place: the simple pleasure of finding something worth our attention.</p><p>It doesn’t have to be this way.</p><h2>A little less, a little deeper</h2><p>The most interesting ideas rarely announce themselves with urgency. They ask us to slow down. To sit with a paragraph, follow a footnote, or look out of the window for a moment before moving on.</p><blockquote>“Attention is the rarest and purest form of generosity.”<br /><small>— Simone Weil</small></blockquote><p>Think of the last thing you read that stayed with you. Chances are, you remember where you were. Maybe there was a cup of coffee going cold beside you, or rain against the window. The reading became part of the day, rather than another thing to get through.</p><h2>Making space for the good stuff</h2><p>A good reading habit isn’t about reaching the bottom of a list. It’s about making a little space for curiosity. Choosing a handful of voices you trust. Following an idea because it interests you, not because an algorithm put it in your path.</p><p>Here are a few small things that help:</p><ul><li>Start with something you genuinely want to read.</li><li>Let yourself finish a thought before opening the next one.</li><li>Keep the things you love. Let the rest go.</li></ul><p>There will always be more. That’s the lovely thing about it. You don’t need to read everything to find something that matters.</p><hr /><p><em>This is a sample article in the Fresher demo. Connect your FreshRSS instance to make this space your own.</em></p>`,
      },
    };
  });
}
export function demoCounts(articles: Article[]) {
  const counts: Record<string, number> = {};
  for (const article of articles.filter((a) => !a.categories.includes(READ))) {
    for (const id of [
      ALL,
      article.origin.streamId,
      ...article.categories.filter((c) => c.startsWith("user/-/label/")),
    ])
      counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
