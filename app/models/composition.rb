class Composition < ApplicationRecord
  belongs_to :title, inverse_of: :compositions
  belongs_to :group
  has_many :inclusions, inverse_of: :composition
  has_and_belongs_to_many :composers

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
