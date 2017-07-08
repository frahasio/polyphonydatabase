class Inclusion < ActiveRecord::Base
  belongs_to :source, inverse_of: :inclusions
  belongs_to :piece, inverse_of: :inclusions
  has_many :attributions, inverse_of: :inclusion
  has_many :clefs_inclusions, inverse_of: :inclusion
  has_many :clefs, through: :clefs_inclusions
  accepts_nested_attributes_for :attributions, :piece
  accepts_nested_attributes_for :clefs_inclusions, reject_if: :filler_clef?

  validates :source_id, uniqueness: { scope: :piece_id }

  def attributed_to
    attributions.map(&:anonym_name).join(" | ")
  end

  def attributed_to=(text)
    names = text
      .split("|")
      .map(&:strip)
      .reject(&:blank?)

    Attribution.set_by_names(self, names)
  end

  def filler_clef?(attrs)
    attrs[:annotated_note].blank? && attrs[:id].blank?
  end

  def composers
    attributions.flat_map(&:resolved_composer)
  end
end
