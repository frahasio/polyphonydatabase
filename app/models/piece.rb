class Piece < ActiveRecord::Base
  has_many :inclusions
  has_many :sources, through: :inclusions

  validates :title, presence: true

  def composers
    inclusions.flat_map(&:composers)
  end
end
