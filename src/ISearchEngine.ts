import SearchResult from "./SearchResult.js";

export default interface ISearchEngine {
    search(
        query: string,
        region?: string,
    ): Promise<SearchResult[]>;
}
