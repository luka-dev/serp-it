export default class SearchResult {
    public readonly title: string;
    public readonly url: string;
    public readonly snippet: string;

    constructor(title: string, url: string, snippet: string) {
        this.title = title;
        this.url = url;
        this.snippet = snippet;
    }
}