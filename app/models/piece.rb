class Piece < ActiveRecord::Base
  has_many :inclusions
  has_many :sources, through: :inclusions
  has_many :recordings
  has_many :editions

  accepts_nested_attributes_for :recordings, reject_if: :unfilled?
  accepts_nested_attributes_for :editions, reject_if: :unfilled?

  validates :title, presence: true

  serialize :feasts

  def composers
    inclusions.flat_map(&:composers)
  end

private

  def unfilled?(attrs)
    attrs.values.all?(&:blank?)
  end
end
