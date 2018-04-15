class Clef < ActiveRecord::Base
  # Dead code
  has_many :clefs_inclusions, inverse_of: :clef
  has_many :inclusions, through: :clefs_inclusions

  def note=(note_string)
    super(note_string.downcase)
  end

  def special?
    ["bc", "lut", "org"].include?(:note)
  end
end
