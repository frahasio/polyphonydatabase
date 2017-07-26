class Searcher
  def initialize(unique_piece, inclusions)
    @unique_piece = unique_piece
    @inclusions = inclusions
  end

  def search(term)
    [
      @unique_piece.title,
      composers.map(&:aliased_as).join(" | "),
      composers.map(&:name).join(" | "),
      sources.map(&:title).join(" | "),
      sources.map(&:code).join(" | "),
      sources.map(&:location_and_pubscribe).join(" | "),
      sources.map(&:dates).join(" | "),
      sources.map(&:type).join(" | "),
      editions.map(&:voicing).join(" | "),
      editions.map(&:editor).join(" | "),
      editions.map(&:file_url).join(" | "),
      recordings.map(&:performer).join(" | "),
      recordings.map(&:file_url).join(" | "),
    ].any? { |string| string.downcase.include?(term.downcase) }
  end

private

  def sources
    @sources ||= @inclusions.map(&:source).compact
  end

  def composers
    @composers ||= @inclusions.first.composers.compact
  end

  def editions
    @editions ||= @unique_piece.editions
  end

  def recordings
    @recordings ||= @unique_piece.recordings
  end
end
