import { existsSync } from 'node:fs';
import path from 'node:path';
import { getCollection, type CollectionEntry } from 'astro:content';
import { slugify } from './slugify';

const WORDS_PER_MINUTE = 230;

export interface Book {
  id: string;
  url: string;
  title: string;
  author: string;
  authorSlug: string;
  genre: string;
  genreSlug: string;
  year: number;
  added: Date;
  minutes: number;
  hasAudio: boolean;
  audioUrl: string;
  entry: CollectionEntry<'summaries'>;
}

const base = import.meta.env.BASE_URL;

function toBook(entry: CollectionEntry<'summaries'>): Book {
  const words = (entry.body ?? '').split(/\s+/).filter(Boolean).length;
  return {
    id: entry.id,
    url: `${base}${entry.id}/`,
    title: entry.data.title,
    author: entry.data.author,
    authorSlug: entry.id.split('/')[0],
    genre: toTitleCase(entry.data.genre),
    genreSlug: slugify(entry.data.genre),
    year: entry.data.publication_year,
    added: entry.data.summary_generated,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    hasAudio: existsSync(path.join(process.cwd(), 'public', 'audio', `${entry.id}.mp3`)),
    audioUrl: `${base}audio/${entry.id}.mp3`,
    entry,
  };
}

export async function getBooks(): Promise<Book[]> {
  const entries = await getCollection('summaries');
  return entries.map(toBook).sort((a, b) => a.title.localeCompare(b.title));
}

export interface Group {
  slug: string;
  name: string;
  books: Book[];
}

export function groupBy(books: Book[], key: 'author' | 'genre'): Group[] {
  const groups = new Map<string, Group>();
  for (const book of books) {
    const slug = key === 'author' ? book.authorSlug : book.genreSlug;
    const group = groups.get(slug) ?? { slug, name: book[key], books: [] };
    group.books.push(book);
    groups.set(slug, group);
  }
  const sortKey = (g: Group) => (key === 'author' ? surname(g.name) : g.name);
  return [...groups.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

// Frontmatter genres vary in case ("Literary fiction" / "Literary Fiction").
function toTitleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function surname(name: string): string {
  return name.split(' ').at(-1) ?? name;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
