class UniquePiece < ActiveRecord::Base
  has_many :recordings, dependent: :destroy, autosave: true, inverse_of: :unique_piece
  has_many :editions, inverse_of: :unique_piece

  accepts_nested_attributes_for :recordings, reject_if: :unfilled?
  accepts_nested_attributes_for :editions, reject_if: :unfilled?

  serialize :feasts, Array

  before_save :mark_blanks_for_deletion

  def feasts=(functions)
    super(functions.reject(&:blank?))
  end

  def feast_names
    feasts.map { |f| Feast::FEASTS[f] }
  end

  def self.group(inclusions)
    inclusions.group_by do |inclusion|
      UniquePiece.find_or_initialize_by(
        title: inclusion&.piece&.title,
        composers: inclusion.composers.compact.map(&:id).join(","),
        minimum_voices: inclusion.minimum_voice_count,
      )
    end
  end

private

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
