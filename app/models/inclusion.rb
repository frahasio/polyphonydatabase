class Inclusion < ActiveRecord::Base
  belongs_to :source, inverse_of: :inclusions
  belongs_to :piece, inverse_of: :inclusions
  has_many :attributions, inverse_of: :inclusion
  has_many :clefs_inclusions, inverse_of: :inclusion
  has_many :clefs, through: :clefs_inclusions
  accepts_nested_attributes_for :attributions, :piece
  accepts_nested_attributes_for :clefs_inclusions, reject_if: :blank_clef?
  # has_many :forced_composers, class_name: "Composer"
  # has_many :cited_composers, through: :attributions, source: :composer
  # has_many :inferred_composers, through: :attributions, source: :composers
  #
  # def composers
  #   forced_composers.union(cited_composers).union(inferred_composers)
  # end

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

  def blank_clef?(attrs)
    attrs[:annotated_note].blank?
  end
end
