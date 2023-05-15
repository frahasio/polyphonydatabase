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
    "P" => "peregrini toni",
    "M" => "mixti/proprii toni",
  }.freeze

  enum tone: TONES.keys
  enum even_odd: %w[even odd both].freeze

  accepts_nested_attributes_for :title

  before_validation :ensure_group, :look_up_title

  def delete_if_empty(inclusion_to_ignore)
    if inclusions.empty? || inclusions == [inclusion_to_ignore]
      self.destroy
      group.delete_if_empty(self)
    end
  end

  private

  def ensure_group
    self.group ||= Group.new(display_title: title&.text)
  end

  def look_up_title
    current_title = self.title
    existing_title = Title.find_by(text: current_title.text)
    if existing_title
      self.title = existing_title
    end
  end
end
