class Composition < ApplicationRecord
  belongs_to :title
  belongs_to :group
  has_many :inclusions, inverse_of: :composition
  has_and_belongs_to_many :composers

  accepts_nested_attributes_for :title

  before_validation :ensure_group

  private

  def ensure_group
    group ||= Group.new(display_title: title&.text)
  end
end
