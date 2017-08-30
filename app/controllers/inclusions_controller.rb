class InclusionsController < ApplicationController
  def index
    unique_pieces = UniquePiece.distinct.limit(100).includes(
      :composers,
      :editions,
      :recordings,
      inclusions: [
        :source,
        clefs_inclusions: [
          :clef,
        ],
      ],
    )

    @unique_pieces = filter(unique_pieces)
  end

private

  def filter(unique_pieces)
    unique_pieces = search(unique_pieces)
    unique_pieces = function(unique_pieces)
    unique_pieces = composer(unique_pieces)
    unique_pieces = composer_country(unique_pieces)
    unique_pieces = voices(unique_pieces)
    unique_pieces = source(unique_pieces)
    unique_pieces = has_edition?(unique_pieces)
    has_recording?(unique_pieces)
  end

  def search(unique_pieces)
    return unique_pieces if params[:q].blank?

    joined_pieces = unique_pieces.left_outer_joins(
      :editions,
      :recordings,
      composers: {
        aliases: :anonym,
      },
      inclusions: :source,
    )

    joined_pieces.where("unique_pieces.title ILIKE ?", "%#{params[:q]}%")
      .or(joined_pieces.where("anonyms.name ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("composers.name ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("sources.title ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("sources.code ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("sources.location_and_pubscribe ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("sources.dates ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("sources.type ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("editions.voicing ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("editions.editor ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("editions.file_url ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("recordings.performer ILIKE ?", "%#{params[:q]}%"))
      .or(joined_pieces.where("recordings.file_url ILIKE ?", "%#{params[:q]}%"))
  end

  def function(unique_pieces)
    return unique_pieces if params[:function].blank?

    unique_pieces
      .joins(:feasts_unique_pieces)
      .where(feasts_unique_pieces: {feast_code: params[:function]})
  end

  def composer(unique_pieces)
    return unique_pieces if params[:composer].blank?

    unique_pieces.where(composers_unique_pieces: {composer_id: params[:composer]})
  end

  def composer_country(unique_pieces)
    return unique_pieces if params[:composer_country].blank?

    unique_pieces.where(composers: {birthplace_2: params[:composer_country]})
  end

  def voices(unique_pieces)
    return unique_pieces if params[:voices].blank?

    unique_pieces.where(minimum_voices: params[:voices])
  end

  def source(unique_pieces)
    return unique_pieces if params[:source].blank?

    unique_pieces
      .joins(:inclusions)
      .where(sources: {id: params[:source]})
  end

  def has_edition?(unique_pieces)
    return unique_pieces if params[:has_edition].blank?

    unique_pieces.where(has_edition: true)
  end

  def has_recording?(unique_pieces)
    return unique_pieces if params[:has_recording].blank?

    unique_pieces.where(has_recording: true)
  end
end
