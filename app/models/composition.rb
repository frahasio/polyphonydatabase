class Composition < ApplicationRecord
  belongs_to :title, inverse_of: :compositions
  belongs_to :group
  has_many :inclusions, inverse_of: :composition
  has_and_belongs_to_many :composers
  belongs_to :composition_type, inverse_of: :compositions, optional: true

  TONES = {
    "1" => "primi toni",
    "2" => "secundi toni",
    "3" => "tertii toni",
    "4" => "quarti toni",
    "5" => "quinti toni",
    "6" => "sexti toni",
    "7" => "septimi toni",
    "8" => "octavi toni",
    "9" => "noni toni",
    "12" => "duodecimi toni",
    "mix" => "mixti toni",
    "per" => "peregrini toni",
    "pro" => "proprii toni",
  }.freeze

  EVEN_ODD = {
    "even" => "pares",
    "odd" => "impares",
    "both" => "pares & impares",
  }.freeze

  enum tone: TONES.keys
  enum even_odd: EVEN_ODD.keys

  accepts_nested_attributes_for :title

  before_validation :ensure_group

  before_validation do
    self.composer_id_list = composer_ids.sort
  end

  validates :title_id, uniqueness: { scope: %i[
    composer_id_list
    composition_type_id
    even_odd
    number_of_voices
    tone
  ] }

  def delete_if_empty(inclusion_to_ignore)
    if inclusions.empty? || inclusions == [inclusion_to_ignore]
      self.destroy
      group.delete_if_empty(self)
    end
  end

  def text
    [
      title.text,
      composers.pluck(:name).join(', '),
      composition_type&.name,
      TONES[tone],
      EVEN_ODD[even_odd],
      ("#{number_of_voices} #{"voice".pluralize(number_of_voices)}" if number_of_voices),
    ].compact_blank.join(' - ')
  end

  private

  def ensure_group
    self.group ||= Group.new(display_title: title&.text)
  end
end
