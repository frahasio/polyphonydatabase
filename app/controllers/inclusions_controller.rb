class InclusionsController < ApplicationController
  def index
    @grouped_inclusions = UniquePiece.group(Inclusion.all)
    @grouped_inclusions = filter(@grouped_inclusions)
  end

private

  def filter(grouped_inclusions)
    return grouped_inclusions unless params[:q]

    grouped_inclusions.select { |unique_piece, inclusions|
      search(params[:q], unique_piece, inclusions) &&
      function(params[:function], unique_piece) &&
      composer(params[:composer], unique_piece) &&
      composer_country(params[:composer_country], inclusions) &&
      voices(params[:voices], unique_piece) &&
      source(params[:source], inclusions) &&
      has_edition?(params[:has_edition], unique_piece) &&
      has_recording?(params[:has_recording], unique_piece)
    }
  end

  def search(term, unique_piece, inclusions)
    return true if term.blank?

    [
      unique_piece.title,
      inclusions.first.composers.compact.map(&:aliased_as).join(" | "),
      inclusions.first.composers.compact.map(&:name).join(" | "),
      inclusions.map(&:source).compact.map(&:title).join(" | "),
      inclusions.map(&:source).compact.map(&:code).join(" | "),
      inclusions.map(&:source).compact.map(&:location_and_pubscribe).join(" | "),
      inclusions.map(&:source).compact.map(&:dates).join(" | "),
      inclusions.map(&:source).compact.map(&:type).join(" | "),
    ].any? { |string| string.include?(term) }
  end

  def function(function_code, unique_piece)
    return true if function_code.blank?

    unique_piece.feasts.include?(function_code)
  end

  def composer(composer_id, unique_piece)
    return true if composer_id.blank?

    unique_piece.composers.split(",").include?(composer_id)
  end

  def composer_country(composer_country_text, inclusions)
    return true if composer_country_text.blank?

    composers = inclusions.first.composers.compact
    composers.any? {|c| c.birthplace_2 == composer_country_text }
  end

  def voices(minimum_voices, unique_piece)
    return true if minimum_voices.blank?

    unique_piece.minimum_voices.to_s == minimum_voices
  end

  def source(source_id, inclusions)
    return true if source_id.blank?

    inclusions.any? {|i| i.source_id.to_s == source_id }
  end

  def has_edition?(has_edition, unique_piece)
    return true if has_edition.blank?

    has_edition == "1" && unique_piece.editions.any?
  end

  def has_recording?(has_recording, unique_piece)
    return true if has_recording.blank?

    has_recording == "1" && unique_piece.recordings.any?
  end
end
