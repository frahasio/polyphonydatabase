class Piece < ActiveRecord::Base
  has_many :inclusions
  has_many :sources, through: :inclusions
  has_many :recordings, dependent: :destroy, autosave: true
  has_many :editions

  accepts_nested_attributes_for :recordings, reject_if: :unfilled?
  accepts_nested_attributes_for :editions, reject_if: :unfilled?

  validates :title, presence: true

  serialize :feasts

  before_save :mark_blanks_for_deletion

  def composers
    inclusions.flat_map(&:composers)
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
