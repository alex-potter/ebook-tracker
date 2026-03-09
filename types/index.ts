export interface EbookChapter {
  id: string;
  title: string;
  text: string;
  order: number;
}

export interface ParsedEbook {
  title: string;
  author: string;
  chapters: EbookChapter[];
}

export interface CharacterRelationship {
  character: string;
  relationship: string;
}

export interface Character {
  name: string;
  aliases: string[];
  importance: 'main' | 'secondary' | 'minor';
  status: 'alive' | 'dead' | 'unknown' | 'uncertain';
  lastSeen: string;
  currentLocation: string;
  description: string;
  relationships: CharacterRelationship[];
  recentEvents: string;
}

export interface AnalysisResult {
  characters: Character[];
  summary: string;
}
