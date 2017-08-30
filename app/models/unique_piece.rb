class UniquePiece < ActiveRecord::Base
  has_many :recordings, dependent: :destroy, autosave: true, inverse_of: :unique_piece
  has_many :editions, inverse_of: :unique_piece
  has_many :feasts_unique_pieces, inverse_of: :unique_piece
  has_many :composers_unique_pieces, inverse_of: :unique_piece
  has_many :composers, through: :composers_unique_pieces
  has_many :inclusions, inverse_of: :unique_piece

  accepts_nested_attributes_for :recordings, reject_if: :unfilled?
  accepts_nested_attributes_for :editions, reject_if: :unfilled?

  serialize :feasts, Array

  before_save :mark_blanks_for_deletion

  def feasts=(functions)
    tidy_feasts = functions.reject(&:blank?)

    super(tidy_feasts)
    self.feasts_unique_pieces = tidy_feasts.map { |f|
      FeastsUniquePiece.new(feast_code: f)
    }
  end

  def feast_names
    feasts.map { |f| Feast::FEASTS[f] }
  end

  def self.group(inclusions)
    unique_pieces = UniquePiece.all.to_a
    eager_load(inclusions).group_by do |inclusion|
      title = inclusion&.piece&.title
      composers = inclusion.composers.compact.map(&:id).sort.join(",")
      minimum_voices = inclusion.minimum_voice_count

      unique_pieces.find { |up|
        up.title == title && up.composers == composers && up.minimum_voices == minimum_voices
      } || UniquePiece.new(title: title, composers: composers, minimum_voices: minimum_voices)
    end
  end

private

  def self.eager_load(inclusions)
    return inclusions unless inclusions.respond_to?(:includes)

    inclusions.includes(
      :piece,
      :source,
      attributions: [
        :composer,
        alias: [
          :composer
        ],
      ],
      clefs_inclusions: [
        :clef,
      ],
    )
  end

  def unfilled?(attrs)
    attrs.values.all?(&:blank?)
  end

  def mark_blanks_for_deletion
    editions.each do |edition|
      if edition.attributes.slice("editor", "voicing", "file_url").values.all?(&:blank?)
        edition.mark_for_destruction
      end
    end

    recordings.each do |recording|
      if recording.attributes.slice("performer", "file_url").values.all?(&:blank?)
        recording.mark_for_destruction
      end
    end
  end
end
