class Inclusion < ActiveRecord::Base
  belongs_to :source, inverse_of: :inclusions
  belongs_to :piece, inverse_of: :inclusions, optional: true
  belongs_to :unique_piece, inverse_of: :inclusions, optional: true
  belongs_to :composition, inverse_of: :inclusions
  has_many :composers, through: :attributions, source: :refers_to
  has_many :attributions, inverse_of: :inclusion, dependent: :destroy
  has_many :clefs_inclusions, inverse_of: :inclusion
  has_many :clefs, through: :clefs_inclusions
  accepts_nested_attributes_for :piece, reject_if: :all_blank
  accepts_nested_attributes_for :composition
  accepts_nested_attributes_for :attributions, reject_if: :all_blank
  accepts_nested_attributes_for :clefs_inclusions, reject_if: :filler_clef?

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

  def from_year
    source.from_year
  end

  def minimum_voice_count
    clefs_inclusions.where(partial: false).joins(:clef).where.not(clefs: {note: ['bc','lut','org']}).length
  end

  def voice_count
    clefs_inclusions.count
  end
end
